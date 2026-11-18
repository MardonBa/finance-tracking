/**
 * Scripted stand-in for Gemini. Tests NEVER call the real API (free-tier
 * limits): each step sees the request the harness built and returns the
 * response Gemini would, or throws (e.g. a 429).
 */
import type { Content, FunctionCall, GeminiClient, GenerateRequest, GenerateResponse, Part } from "../../src/ai/gemini.ts";

export type Step = (request: GenerateRequest, model: string) => GenerateResponse;

export interface FakeGemini extends GeminiClient {
  requests: { model: string; body: GenerateRequest }[];
}

export function fakeGemini(steps: Step[]): FakeGemini {
  const requests: FakeGemini["requests"] = [];
  let i = 0;
  return {
    requests,
    async generate(model, request) {
      // Deep copy: the harness keeps appending to `contents` after the call.
      requests.push({ model, body: structuredClone(request) });
      const step = steps[Math.min(i++, steps.length - 1)];
      if (!step) throw new Error("fake Gemini has no scripted response");
      return step(request, model);
    },
  };
}

export function reply(parts: Part[]): GenerateResponse {
  return { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } };
}

export const text = (t: string): Step => () => reply([{ text: t }]);
export const calls = (...fcs: FunctionCall[]): Step => () => reply(fcs.map((functionCall) => ({ functionCall, thoughtSignature: "sig" })));

/** The function responses the harness sent in the last request. */
export function lastToolResponses(request: GenerateRequest): Record<string, unknown>[] {
  const last: Content | undefined = request.contents[request.contents.length - 1];
  return (last?.parts ?? []).filter((p) => p.functionResponse).map((p) => p.functionResponse!.response);
}
