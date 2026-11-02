import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SitePicker } from "@/client/features/gsc/SitePicker";
import { Ga4PropertyPicker } from "@/client/features/ga4/Ga4PropertyPicker";

vi.mock("./startGoogleLink", () => ({ startGoogleLink: vi.fn() }));

const callbacks = {
  loading: false,
  error: false,
  selection: null,
  onSelect: vi.fn(),
  onSave: vi.fn(),
  saving: false,
  onRetry: vi.fn(),
  onReconnect: vi.fn(),
};

describe("Google property discovery recovery", () => {
  it("offers retry and preserves usable GSC accounts when discovery is unavailable", () => {
    const markup = renderToStaticMarkup(
      createElement(SitePicker, {
        ...callbacks,
        accounts: [
          {
            accountId: "unavailable",
            email: null,
            requiresReconnect: false,
            sitesUnavailable: true,
            sites: [],
          },
          {
            accountId: "healthy",
            email: null,
            requiresReconnect: false,
            sitesUnavailable: false,
            sites: [
              {
                siteUrl: "https://example.com/",
                permissionLevel: "siteOwner",
                selectable: true,
                isSelected: false,
              },
            ],
          },
        ],
      }),
    );
    expect(markup).toContain("Try again");
    expect(markup).toContain("https://example.com/");
    expect(markup).not.toContain("Connection expired");
    expect(markup).not.toContain("Reconnect with Google");
  });

  it("offers retry for unavailable GA4 accounts without claiming expiry", () => {
    const markup = renderToStaticMarkup(
      createElement(Ga4PropertyPicker, {
        ...callbacks,
        accounts: [
          {
            accountId: "unavailable",
            email: null,
            requiresReconnect: false,
            propertiesUnavailable: true,
            properties: [],
          },
        ],
      }),
    );
    expect(markup).toContain("Try again");
    expect(markup).not.toContain("Connection expired");
    expect(markup).not.toContain("Reconnect with Google");
    expect(markup).not.toContain(
      "No Google Analytics properties are available",
    );
  });

  it("offers reconnection for rejected credentials without inventing expiry", () => {
    const gsc = renderToStaticMarkup(
      createElement(SitePicker, {
        ...callbacks,
        accounts: [
          {
            accountId: "rejected",
            email: null,
            requiresReconnect: true,
            sitesUnavailable: false,
            sites: [],
          },
        ],
      }),
    );
    const ga4 = renderToStaticMarkup(
      createElement(Ga4PropertyPicker, {
        ...callbacks,
        accounts: [
          {
            accountId: "rejected",
            email: null,
            requiresReconnect: true,
            propertiesUnavailable: false,
            properties: [],
          },
        ],
      }),
    );
    for (const markup of [gsc, ga4]) {
      expect(markup).toContain("Google rejected this connection");
      expect(markup).toContain("Reconnect with Google");
      expect(markup).not.toContain("Connection expired");
    }
  });
});
