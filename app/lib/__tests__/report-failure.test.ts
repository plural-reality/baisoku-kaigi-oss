import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import {
  decodeReportFailure,
  encodeReportFailure,
  reportFailureCodes,
} from "../report-failure";
import { templateOfRequest } from "../report-template-prompts";

describe("report failure codes", () => {
  it("round-trips a code and the provider's reason, colons included", () => {
    expect(
      decodeReportFailure(encodeReportFailure("forbidden", "limit: daily")),
    ).toEqual({ code: "forbidden", detail: "limit: daily" });
    expect(decodeReportFailure(encodeReportFailure("timeout"))).toEqual({
      code: "timeout",
      detail: "",
    });
  });

  it("leaves a sentence stored before codes, or an unknown code, as text", () => {
    expect(decodeReportFailure("レポートの生成が中断されました")).toBeNull();
    expect(decodeReportFailure("report-failure:unknown")).toBeNull();
  });

  it("has an English wording for every code", () => {
    expect(
      reportFailureCodes.filter((code) => !en.reportFailure[code]),
    ).toEqual([]);
  });
});

describe("templateOfRequest", () => {
  it("recognises a stored template request and nothing else", () => {
    expect(
      templateOfRequest(
        "論理的で明確な構成を重視し、意思決定に必要な情報を簡潔にまとめてください。データや数値、合意・対立のポイントを明確に示し、次のアクションにつながる提言を含めてください。\n",
      ),
    ).toBe("logical");
    expect(templateOfRequest("Focus on the budget")).toBeNull();
  });
});
