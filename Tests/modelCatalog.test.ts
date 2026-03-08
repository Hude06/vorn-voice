import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, MODEL_CATALOG } from "../src/shared/types";

describe("shared defaults", () => {
  it("ships with small model default", () => {
    expect(DEFAULT_SETTINGS.activeModelId).toBe("small.en");
  });

  it("includes small model in catalog", () => {
    expect(MODEL_CATALOG.some((model) => model.id === "small.en")).toBe(true);
  });
});
