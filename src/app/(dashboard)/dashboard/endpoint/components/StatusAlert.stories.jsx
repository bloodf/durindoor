import React from "react";

import StatusAlert from "./StatusAlert";

const meta = {
  title: "Production/endpoint/StatusAlert",
  component: StatusAlert,
  parameters: { layout: "padded" },
};

export default meta;

export const Success = {
  args: { status: { type: "success", message: "Tunnel disabled" } },
};

export const Warning = {
  args: { status: { type: "warning", message: "Connected but not reachable yet." } },
};

export const Info = {
  args: { status: { type: "info", message: "See https://durindoor.dev/docs for setup steps." } },
};

/** Error tone is the default fallback and carries role="alert". */
export const ErrorWithLink = {
  args: { status: { type: "error", message: "Failed to reveal key. Visit https://durindoor.dev/support for help." } },
};
