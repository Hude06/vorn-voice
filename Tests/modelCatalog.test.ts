import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, MODEL_CATALOG } from "../src/shared/types";

describe("shared defaults", () => {
  it("ships with base model default", () => {
    expect(DEFAULT_SETTINGS.activeModelId).toBe("base.en");
  });

  it("includes base model in catalog", () => {
    expect(MODEL_CATALOG.some((model) => model.id === "base.en")).toBe(true);
  });
});
