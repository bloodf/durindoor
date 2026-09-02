import React from "react";

import { Card } from "@/shared/ui/components/Card.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";

export default function ProxyPoolsPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="router"
        title="Proxy Pools"
        subtitle="Manage your proxy pool configurations"
      />

      <Card padding={false}>
        <EmptyState
          icon="router"
          title="No proxy pools yet"
          message="Add a proxy pool to distribute gateway traffic across managed proxy endpoints."
          action={{ label: "Add Proxy Pool", icon: "add", onClick: () => undefined }}
        />
      </Card>
    </div>
  );
}
