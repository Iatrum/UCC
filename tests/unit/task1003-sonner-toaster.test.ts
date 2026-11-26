import { expect, spyOn, test } from "bun:test";
import * as nextHeaders from "next/headers";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "../../app/layout";

test("the root layout renders the Sonner toaster on application routes", async () => {
  const headers = spyOn(nextHeaders, "headers").mockResolvedValue(
    new Headers({ host: "localhost", "x-pathname": "/dashboard" }),
  );

  try {
    const layout = await RootLayout({ children: createElement("main") });
    expect(renderToStaticMarkup(layout)).toContain(
      '<section aria-label="Notifications alt+T"',
    );
  } finally {
    headers.mockRestore();
  }
});
