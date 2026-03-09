import { describe, expect, it } from "vitest";
import { BUNDLED_MODEL_IDS, DEFAULT_MODEL_ID, DEFAULT_SETTINGS, MODEL_CATALOG } from "../src/shared/types";

describe("shared defaults", () => {
  it("ships with base model default", () => {
    expect(DEFAULT_MODEL_ID).toBe("base.en");
    expect(DEFAULT_SETTINGS.activeModelId).toBe(DEFAULT_MODEL_ID);
  });

  it("keeps the default model bundled for first run", () => {
    expect(BUNDLED_MODEL_IDS).toContain(DEFAULT_SETTINGS.activeModelId);
  });

  it("includes every bundled model in the catalog", () => {
    for (const modelId of BUNDLED_MODEL_IDS) {
      expect(MODEL_CATALOG.some((model) => model.id === modelId)).toBe(true);
    }
  });

  it("includes small model in catalog", () => {
    expect(MODEL_CATALOG.some((model) => model.id === "small.en")).toBe(true);
  });
});
