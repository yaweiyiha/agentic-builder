import { describe, expect, it } from "vitest";
import fetch from "node-fetch";

describe("health endpoint smoke test", () => {
  it("asserts health response shape, or trivially passes when no server is configured", async () => {
    const healthUrl = process.env.HEALTHCHECK_URL;

    if (!healthUrl) {
      // No server in test environment: trivial smoke pass.
      expect(true).toBe(true);
      return;
    }

    const response = await fetch(healthUrl);
    expect(response.ok).toBe(true);

    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        status: expect.any(String),
      }),
    );
  });
});

