export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          operationName?: string;
          query?: string;
          variables?: Json;
          extensions?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      agent_instances: {
        Row: {
          agent_type: string;
          created_at: string;
          id: string;
          state: string;
          state_payload: Json;
          thread_id: string;
          updated_at: string;
        };
        Insert: {
          agent_type: string;
          created_at?: string;
          id?: string;
          state: string;
          state_payload?: Json;
          thread_id: string;
          updated_at?: string;
        };
        Update: {
          agent_type?: string;
          created_at?: string;
          id?: string;
          state?: string;
          state_payload?: Json;
          thread_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_instances_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "event_threads";
            referencedColumns: ["id"];
          },
        ];
      };
      event_threads: {
        Row: {
          created_at: string;
          id: string;
          session_id: string;
          should_proceed: boolean;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          session_id: string;
          should_proceed?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          session_id?: string;
          should_proceed?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_threads_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          agent_id: string | null;
          created_at: string;
          id: string;
          order_index: number;
          payload: Json;
          progress: number;
          thread_id: string;
          type: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          agent_id?: string | null;
          created_at?: string;
          id?: string;
          order_index?: number;
          payload?: Json;
          progress?: number;
          thread_id: string;
          type: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          agent_id?: string | null;
          created_at?: string;
          id?: string;
          order_index?: number;
          payload?: Json;
          progress?: number;
          thread_id?: string;
          type?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "events_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agent_instances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "event_threads";
            referencedColumns: ["id"];
          },
        ];
      };
      individual_reports: {
        Row: {
          content_markdown: string;
          created_at: string;
          deep_dive_questions: Json;
          generation_id: string | null;
          id: string;
          model: string | null;
          participant_user_id: string;
          prompt_version: string | null;
          session_id: string;
        };
        Insert: {
          content_markdown: string;
          created_at?: string;
          deep_dive_questions?: Json;
          generation_id?: string | null;
          id?: string;
          model?: string | null;
          participant_user_id: string;
          prompt_version?: string | null;
          session_id: string;
        };
        Update: {
          content_markdown?: string;
          created_at?: string;
          deep_dive_questions?: Json;
          generation_id?: string | null;
          id?: string;
          model?: string | null;
          participant_user_id?: string;
          prompt_version?: string | null;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "individual_reports_participant_fk";
            columns: ["participant_user_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["user_id", "session_id"];
          },
        ];
      };
      llm_cache: {
        Row: {
          cache_key: string;
          created_at: string;
          model: string | null;
          prompt_version: string | null;
          response: string;
        };
        Insert: {
          cache_key: string;
          created_at?: string;
          model?: string | null;
          prompt_version?: string | null;
          response: string;
        };
        Update: {
          cache_key?: string;
          created_at?: string;
          model?: string | null;
          prompt_version?: string | null;
          response?: string;
        };
        Relationships: [];
      };
      participant_reflections: {
        Row: {
          created_at: string;
          id: string;
          participant_user_id: string;
          session_id: string;
          submitted_at: string;
          text: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          participant_user_id: string;
          session_id: string;
          submitted_at?: string;
          text: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          participant_user_id?: string;
          session_id?: string;
          submitted_at?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "participant_reflections_participant_fk";
            columns: ["participant_user_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["user_id", "session_id"];
          },
        ];
      };
      participants: {
        Row: {
          created_at: string;
          latest_individual_report_id: string | null;
          name: string;
          session_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          latest_individual_report_id?: string | null;
          name: string;
          session_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          latest_individual_report_id?: string | null;
          name?: string;
          session_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "participants_latest_report_fk";
            columns: ["latest_individual_report_id"];
            isOneToOne: false;
            referencedRelation: "individual_reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "participants_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      responses: {
        Row: {
          answer_source: string | null;
          created_at: string;
          id: string;
          participant_user_id: string;
          response_type: string;
          session_id: string;
          statement_id: string;
          text_response: string | null;
          updated_at: string;
          value: number | null;
        };
        Insert: {
          answer_source?: string | null;
          created_at?: string;
          id?: string;
          participant_user_id: string;
          response_type?: string;
          session_id: string;
          statement_id: string;
          text_response?: string | null;
          updated_at?: string;
          value?: number | null;
        };
        Update: {
          answer_source?: string | null;
          created_at?: string;
          id?: string;
          participant_user_id?: string;
          response_type?: string;
          session_id?: string;
          statement_id?: string;
          text_response?: string | null;
          updated_at?: string;
          value?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "responses_participant_fk";
            columns: ["participant_user_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["user_id", "session_id"];
          },
          {
            foreignKeyName: "responses_statement_id_fkey";
            columns: ["statement_id"];
            isOneToOne: false;
            referencedRelation: "statements";
            referencedColumns: ["id"];
          },
        ];
      };
      session_reports: {
        Row: {
          completed_at: string | null;
          content_markdown: string | null;
          created_at: string;
          created_by: string;
          error_message: string | null;
          generation_id: string | null;
          id: string;
          model: string;
          prompt_snapshot: Json;
          prompt_version: string | null;
          request_markdown: string;
          session_id: string;
          status: string;
          token_usage: Json | null;
          updated_at: string;
          version: number;
        };
        Insert: {
          completed_at?: string | null;
          content_markdown?: string | null;
          created_at?: string;
          created_by: string;
          error_message?: string | null;
          generation_id?: string | null;
          id?: string;
          model: string;
          prompt_snapshot?: Json;
          prompt_version?: string | null;
          request_markdown?: string;
          session_id: string;
          status?: string;
          token_usage?: Json | null;
          updated_at?: string;
          version?: number;
        };
        Update: {
          completed_at?: string | null;
          content_markdown?: string | null;
          created_at?: string;
          created_by?: string;
          error_message?: string | null;
          generation_id?: string | null;
          id?: string;
          model?: string;
          prompt_snapshot?: Json;
          prompt_version?: string | null;
          request_markdown?: string;
          session_id?: string;
          status?: string;
          token_usage?: Json | null;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "session_reports_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      sessions: {
        Row: {
          admin_access_token: string;
          context: string;
          created_at: string;
          facilitator_context: string | null;
          facilitator_goal: string | null;
          goal: string;
          host_user_id: string;
          id: string;
          is_public: boolean;
          language: string;
          source_url: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          admin_access_token?: string;
          context: string;
          created_at?: string;
          facilitator_context?: string | null;
          facilitator_goal?: string | null;
          goal?: string;
          host_user_id: string;
          id?: string;
          is_public?: boolean;
          language?: string;
          source_url?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          admin_access_token?: string;
          context?: string;
          created_at?: string;
          facilitator_context?: string | null;
          facilitator_goal?: string | null;
          goal?: string;
          host_user_id?: string;
          id?: string;
          is_public?: boolean;
          language?: string;
          source_url?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      situation_analysis_reports: {
        Row: {
          content_markdown: string;
          created_at: string;
          id: string;
          session_id: string;
        };
        Insert: {
          content_markdown: string;
          created_at?: string;
          id?: string;
          session_id: string;
        };
        Update: {
          content_markdown?: string;
          created_at?: string;
          id?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "situation_analysis_reports_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      statements: {
        Row: {
          created_at: string;
          id: string;
          order_index: number;
          session_id: string;
          text: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          order_index?: number;
          session_id: string;
          text: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          order_index?: number;
          session_id?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "statements_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
