import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { PtolemyAgent } from "./PtolemyAgent";
import type { AgentInstanceRow, AgentRunResult } from "./types";
import { delay, truncate } from "./utils";

export class AgentManager {
  private static readonly RECONNECT_INTERVAL_MS = 60 * 60 * 1000;
  // Failure-triggered refresh backs off exponentially (5s → 10min) so a
  // persistently failing realtime connection (staging, 2026-10-07: all three
  // channels TIMED_OUT) cannot turn into a refresh+bootstrap storm.
  private static readonly REFRESH_ON_FAILURE_MIN_DELAY_MS = 5 * 1000;
  private static readonly REFRESH_ON_FAILURE_MAX_DELAY_MS = 10 * 60 * 1000;
  // A failure-triggered refresh only re-bootstraps instances touched recently;
  // the hourly refresh still re-bootstraps everything.
  private static readonly RECENT_BOOTSTRAP_WINDOW_MS = 2 * 60 * 60 * 1000;
  private failureRefreshDelayMs = AgentManager.REFRESH_ON_FAILURE_MIN_DELAY_MS;
  private supabase: SupabaseClient;
  private ptolemy: PtolemyAgent;
  private processing = new Set<string>();
  // Instances notified while a run was in progress. That run may have read the
  // state before the change (e.g. the response that crosses the 80% threshold),
  // so it is run once more afterwards instead of the notification being lost
  // until the hourly re-bootstrap.
  private rerunRequested = new Set<string>();
  private subscriptions: RealtimeChannel[] = [];
  private reconnectInterval?: NodeJS.Timeout;
  private isRefreshing = false;

  constructor(
    private readonly supabaseUrl: string = process.env
      .NEXT_PUBLIC_SUPABASE_URL ?? "",
    private readonly supabaseServiceRoleKey: string = process.env
      .SUPABASE_SERVICE_ROLE_KEY ?? "",
  ) {
    if (!this.supabaseUrl || !this.supabaseServiceRoleKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      );
    }

    this.supabase = this.createSupabaseClient();
    this.ptolemy = new PtolemyAgent(this.supabase);
  }

  async start() {
    console.log("[AgentManager] Starting…");
    await this.bootstrapExistingAgents();
    await this.initializeRealtimeSubscriptions();
    this.scheduleReconnect();
    console.log("[AgentManager] Ready");
  }

  async stop() {
    if (this.refreshSoonTimer) {
      clearTimeout(this.refreshSoonTimer);
      this.refreshSoonTimer = undefined;
    }
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = undefined;
    }
    await this.stopRealtimeSubscriptions();
  }

  private async bootstrapExistingAgents(options?: { recentOnly?: boolean }) {
    const query = this.supabase.from("agent_instances").select("id");
    const { data, error } = options?.recentOnly
      ? await query.gte(
          "updated_at",
          new Date(
            Date.now() - AgentManager.RECENT_BOOTSTRAP_WINDOW_MS,
          ).toISOString(),
        )
      : await query;

    if (error) {
      console.error("[AgentManager] Failed to bootstrap agents:", error);
      return;
    }

    console.log(
      `[AgentManager] bootstrapping ${data?.length ?? 0} agent(s)${options?.recentOnly ? " (recent)" : ""}`,
    );
    for (const row of data ?? []) {
      this.enqueueHandle(row.id);
    }
  }

  private async subscribeToAgentInstances() {
    const channel = this.supabase
      .channel("agent-instances")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_instances" },
        (payload) => {
          const id = (payload.new as { id?: string })?.id;
          if (id) {
            console.log("[AgentManager] Detected new agent", truncate(id));
            this.enqueueHandle(id);
          }
        },
      );

    this.subscribeWithStatusLog(channel);
    this.subscriptions.push(channel);
  }

  private async subscribeToThreadChanges() {
    const channel = this.supabase
      .channel("event-threads")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "event_threads" },
        (payload) => {
          const threadId = (payload.new as { id?: string })?.id;
          if (threadId) {
            void this.handleThreadUpdate(threadId);
          }
        },
      );

    this.subscribeWithStatusLog(channel);
    this.subscriptions.push(channel);
  }

  private async subscribeToResponses() {
    const channel = this.supabase
      .channel("responses-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "responses" },
        (payload) => {
          const sessionId =
            (payload.new as { session_id?: string })?.session_id ??
            (payload.old as { session_id?: string })?.session_id;
          if (sessionId) {
            void this.handleResponseChange(sessionId);
          }
        },
      );

    this.subscribeWithStatusLog(channel);
    this.subscriptions.push(channel);
  }

  private enqueueHandle(agentId: string) {
    if (!agentId) return;
    void this.handleInstance(agentId);
  }

  private async handleInstance(agentId: string) {
    if (this.processing.has(agentId)) {
      this.rerunRequested.add(agentId);
      return;
    }

    this.processing.add(agentId);
    this.rerunRequested.delete(agentId);
    let shouldRequeue = false;
    try {
      const { data: instance, error } = await this.supabase
        .from("agent_instances")
        .select("id, thread_id, agent_type, state, state_payload")
        .eq("id", agentId)
        .single();

      if (error || !instance) {
        console.error(
          "[AgentManager] Failed to load agent instance:",
          agentId,
          error,
        );
        return;
      }

      let result: AgentRunResult = { status: "idle" };
      if (instance.agent_type === "ptolemy") {
        result = await this.ptolemy.run(instance as AgentInstanceRow);
      } else {
        console.warn(
          `[AgentManager] Unsupported agent_type ${instance.agent_type}`,
        );
      }

      shouldRequeue = result.status === "transitioned";
    } catch (error) {
      console.error(
        "[AgentManager] Error while handling agent",
        agentId,
        error,
      );
    } finally {
      this.processing.delete(agentId);
    }

    if (this.rerunRequested.delete(agentId)) {
      shouldRequeue = true;
    }

    if (shouldRequeue) {
      await delay(50);
      this.enqueueHandle(agentId);
    }
  }

  private async handleThreadUpdate(threadId: string) {
    const { data, error } = await this.supabase
      .from("agent_instances")
      .select("id")
      .eq("thread_id", threadId);

    if (error) {
      console.error("[AgentManager] Failed to load agents for thread:", error);
      return;
    }

    for (const row of data ?? []) {
      this.enqueueHandle(row.id);
    }
  }

  private async handleResponseChange(sessionId: string) {
    const { data: threads, error: threadError } = await this.supabase
      .from("event_threads")
      .select("id")
      .eq("session_id", sessionId);

    if (threadError) {
      console.error("[AgentManager] Failed to load threads:", threadError);
      return;
    }

    const threadIds = (threads ?? []).map((row) => row.id);
    if (threadIds.length === 0) {
      return;
    }

    const { data: agents, error: agentsError } = await this.supabase
      .from("agent_instances")
      .select("id, state")
      .in("thread_id", threadIds);

    if (agentsError) {
      console.error(
        "[AgentManager] Failed to load agents for responses:",
        agentsError,
      );
      return;
    }

    for (const agent of agents ?? []) {
      if (agent.state === "COLLECTING_SURVEY") {
        this.enqueueHandle(agent.id);
      }
    }
  }

  private createSupabaseClient(): SupabaseClient {
    return createClient(this.supabaseUrl, this.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  private async initializeRealtimeSubscriptions() {
    await this.subscribeToAgentInstances();
    await this.subscribeToThreadChanges();
    await this.subscribeToResponses();
  }

  // Realtime delivery used to be invisible in the journal: `subscribe()` was
  // called without a status callback, so a channel that never reached
  // SUBSCRIBED (observed on staging 2026-10-07 — a new agent_instances INSERT
  // and a thread UPDATE never arrived; only the hourly refresh+bootstrap would
  // have picked the session up) looked identical to a healthy one. Log every
  // status transition and refresh the connection promptly when a channel
  // fails or closes unexpectedly, instead of waiting for the hourly timer.
  private subscribeWithStatusLog(channel: RealtimeChannel) {
    channel.subscribe((status, err) => {
      const detail = err
        ? ` (${truncate(String(err.message ?? err), 160)})`
        : "";
      console.log(
        `[AgentManager] realtime ${channel.topic}: ${status}${detail}`,
      );
      const failed =
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED";
      // CLOSED also fires for our own unsubscribe during a refresh; those
      // channels have already been dropped from `subscriptions`.
      if (status === "SUBSCRIBED") {
        this.failureRefreshDelayMs =
          AgentManager.REFRESH_ON_FAILURE_MIN_DELAY_MS;
      }
      if (failed && this.subscriptions.includes(channel)) {
        this.scheduleRefreshSoon();
      }
    });
  }

  private refreshSoonTimer?: NodeJS.Timeout;

  private scheduleRefreshSoon() {
    if (this.refreshSoonTimer || this.isRefreshing) return;
    const delayMs = this.failureRefreshDelayMs;
    this.failureRefreshDelayMs = Math.min(
      delayMs * 2,
      AgentManager.REFRESH_ON_FAILURE_MAX_DELAY_MS,
    );
    console.log(
      `[AgentManager] realtime channel failed; refreshing in ${Math.round(delayMs / 1000)}s`,
    );
    this.refreshSoonTimer = setTimeout(() => {
      this.refreshSoonTimer = undefined;
      void this.refreshSupabaseConnection({ recentOnly: true });
    }, delayMs);
  }

  private scheduleReconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }
    this.reconnectInterval = setInterval(() => {
      void this.refreshSupabaseConnection();
    }, AgentManager.RECONNECT_INTERVAL_MS);
  }

  private async stopRealtimeSubscriptions() {
    const subscriptions = [...this.subscriptions];
    this.subscriptions = [];
    await Promise.all(subscriptions.map((channel) => channel.unsubscribe()));
  }

  private async refreshSupabaseConnection(options?: { recentOnly?: boolean }) {
    if (this.isRefreshing) {
      return;
    }

    this.isRefreshing = true;
    console.log("[AgentManager] Refreshing Supabase connection…");
    try {
      await this.stopRealtimeSubscriptions();
      this.supabase = this.createSupabaseClient();
      this.ptolemy.setSupabaseClient(this.supabase);
      await this.bootstrapExistingAgents(options);
      await this.initializeRealtimeSubscriptions();
      console.log("[AgentManager] Supabase connection refreshed");
    } catch (error) {
      console.error(
        "[AgentManager] Failed to refresh Supabase connection:",
        error,
      );
    } finally {
      this.isRefreshing = false;
    }
  }
}
