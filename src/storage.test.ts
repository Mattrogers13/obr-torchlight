import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { readLocal, writeLocal } from "./storage";
import { useTheme } from "./hooks/useTheme";
import { isDevMode } from "./utils";

describe("browser storage that throws (strict privacy settings)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const block = () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
  };

  it("reads as empty and writes are dropped instead of crashing", () => {
    block();
    expect(readLocal("x")).toBeNull();
    expect(() => writeLocal("x", "1")).not.toThrow();
    expect(isDevMode()).toBe(false);
  });

  it("the theme hook still loads and can change theme", () => {
    block();
    const { result } = renderHook(() => useTheme("dark"));
    expect(result.current.themeId).toBe("dark-fantasy");
    expect(() => result.current.changeTheme("modern-saas")).not.toThrow();
  });

  it("falls back to the default for a theme that no longer exists", () => {
    localStorage.setItem("torchlight-theme", "deleted-theme");
    const { result } = renderHook(() => useTheme("dark"));
    expect(result.current.themeId).toBe("dark-fantasy");
  });
});
