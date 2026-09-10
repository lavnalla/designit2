import { describe, it, expect, afterEach } from "vitest";
import { fabricServiceHeaders } from "../../app/api/fabric/service";

const original = process.env.FABRIC_SERVICE_TOKEN;

afterEach(() => {
  if (original === undefined) delete process.env.FABRIC_SERVICE_TOKEN;
  else process.env.FABRIC_SERVICE_TOKEN = original;
});

describe("proxy -> service auth header", () => {
  it("sends no Authorization header when no token is configured", () => {
    delete process.env.FABRIC_SERVICE_TOKEN;
    expect(fabricServiceHeaders()).toEqual({ "Content-Type": "application/json" });
  });

  it("forwards the shared secret as a bearer token", () => {
    process.env.FABRIC_SERVICE_TOKEN = "  s3cret  ";
    expect(fabricServiceHeaders()).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer s3cret",
    });
  });
});
