"use client";

import Link from "next/link";
import PropTypes from "prop-types";
import { Card, Badge, Toggle } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import { classifyFreeProvider } from "@/shared/constants/providers";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import getStatusDisplay from "./getStatusDisplay";

export default function ProviderCard({
  providerId,
  provider,
  stats,
  authType,
  noAuthEnabled,
  savingNoAuth,
  saving = false,
  onToggle,
  onToggleNoAuth
}) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isNoAuth = !!provider.noAuth;
  const freeClass = classifyFreeProvider(providerId);
  // V5 dims only the icon: whole-card opacity pushes the name and badges under WCAG AA contrast.
  const v5 = useUiV5();
  const dimmed = allDisabled || (isNoAuth && !noAuthEnabled);

  const dotColors = {
    free: "bg-dd-success",
    oauth: "bg-dd-info",
    apikey: "bg-dd-warning",
    compatible: "bg-dd-warning"
  };
  const dotLabels = {
    free: "Free",
    oauth: "OAuth",
    apikey: "API Key",
    compatible: "Compatible"
  };

  return (
    <div className="relative group min-w-0">
      <Link href={`/dashboard/providers/${providerId}`} className="block min-w-0">
        <Card
          padding="xs"
          className={`h-full hover:bg-dd-surface-2/[0.01] dark:hover:bg-dd-surface-2/[0.01] transition-colors cursor-pointer ${dimmed && !v5 ? "opacity-50" : ""}`}>

          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-surface-2${dimmed && v5 ? " opacity-50" : ""}`}>
              {provider.iconUrl ? (
                <ProviderIcon
                  src={provider.iconUrl}
                  alt={provider.name}
                  size={30}
                  className="max-h-[30px] max-w-[30px] rounded-dd object-contain"
                  fallbackText={provider.textIcon || providerId.slice(0, 2).toUpperCase()}
                />
              ) : (
                <ProviderLogo provider={providerId} size={30} />
              )}
            </div>
            <div className="min-w-0 flex-1 pe-12">
              <h3 className="truncate font-semibold">{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                {freeClass === "free" &&
                <Badge variant="success" size="sm">Free</Badge>
                }
                {freeClass === "freeTier" &&
                <Badge variant="info" size="sm">Free Tier</Badge>
                }
                {isNoAuth && !noAuthEnabled ?
                <Badge variant="default" size="sm">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">
                        pause_circle
                      </span>
                      Disabled
                    </span>
                  </Badge> :
                allDisabled ?
                <Badge variant="default" size="sm">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">
                        pause_circle
                      </span>
                      Disabled
                    </span>
                  </Badge> :
                isNoAuth ?
                <Badge variant="default" size="sm" dot>Enabled</Badge> :

                <>
                    {getStatusDisplay(connected, error, errorCode)}
                    {errorTime &&
                  <span className="text-dd-muted">{errorTime}</span>
                  }
                  </>
                }
              </div>
            </div>
          </div>
        </Card>
      </Link>
      {isNoAuth ?
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Toggle
          size="sm"
          checked={noAuthEnabled}
          onChange={() => onToggleNoAuth(!noAuthEnabled)}
          aria-label={noAuthEnabled ? `Disable ${provider.name}` : `Enable ${provider.name}`}
          disabled={savingNoAuth} />

        </div> :
      stats.total > 0 &&
      <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-100">
          <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}>

            <Toggle
            size="sm"
            checked={!allDisabled}
            disabled={saving}
            onChange={() => onToggle(!allDisabled ? false : true)}
            aria-label={allDisabled ? `Enable ${provider.name}` : `Disable ${provider.name}`} />

          </div>
        </div>
      }
    </div>);

}
ProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes['shape']({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    noAuth: PropTypes.bool
  }).isRequired,
  stats: PropTypes['shape']({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string
  }).isRequired,
  authType: PropTypes.string,
  noAuthEnabled: PropTypes.bool,
  savingNoAuth: PropTypes.bool,
  saving: PropTypes.bool,
  onToggle: PropTypes.func,
  onToggleNoAuth: PropTypes.func
};
