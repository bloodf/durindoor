import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { KeySecretNotice } from "../../src/app/(dashboard)/dashboard/keys/KeysPageClient.jsx";

it("tells the user the key can be revealed again", () => {
  const html = renderToStaticMarkup(React.createElement(KeySecretNotice));
  expect(html).toContain("reveal and copy it again from the keys list");
});
