"use client";

import Link from "next/link";
import PropTypes from "prop-types";
import { Card, Badge, Toggle } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import {
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
  classifyFreeProvider,
} from "@/shared/constants/providers";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import getStatusDisplay from "./getStatusDisplay";

export default function ApiKeyProviderCard({
  providerId,
  provider,
  stats,
  authType,
  saving = false,
  onToggle
}) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(
    ANTHROPIC_COMPATIBLE_PREFIX
  );
  const freeClass = classifyFreeProvider(providerId);
  const v5 = useUiV5();

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

  const compatibleFallback = isAnthropicCompatible ? "/providers/anthropic-m.png" :
    isCompatible ? (provider.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png") : null;
  const getIconPath = () => provider.iconUrl || `/providers/${providerId}.png`;

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group min-w-0">
      <Card
        padding="xs"
        className={`h-full hover:bg-dd-surface-2/[0.01] dark:hover:bg-dd-surface-2/[0.01] transition-colors cursor-pointer ${allDisabled && !v5 ? "opacity-50" : ""}`}>

        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className={`flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-surface-2${allDisabled && v5 ? " opacity-50" : ""}`}>
              {provider.iconUrl ? (
                <ProviderIcon
                  src={getIconPath()}
                  fallbackSrc={compatibleFallback || undefined}
                  alt={provider.name}
                  size={30}
                  className="max-h-[30px] max-w-[30px] rounded-dd object-contain"
                  fallbackText={provider.textIcon || providerId.slice(0, 2).toUpperCase()}
                />
              ) : isCompatible || isAnthropicCompatible ? (
                <ProviderIcon
                  src={getIconPath()}
                  fallbackSrc={compatibleFallback || undefined}
                  alt={provider.name}
                  size={30}
                  className="max-h-[30px] max-w-[30px] rounded-dd object-contain"
                  fallbackText={provider.textIcon || providerId.slice(0, 2).toUpperCase()}
                />
              ) : (
                <ProviderLogo provider={providerId} size={30} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold">{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                {freeClass === "free" &&
                <Badge variant="success" size="sm">Free</Badge>
                }
                {freeClass === "freeTier" &&
                <Badge variant="info" size="sm">Free Tier</Badge>
                }
                {allDisabled ?
                <Badge variant="default" size="sm">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">
                        pause_circle
                      </span>
                      Disabled
                    </span>
                  </Badge> :

                <>
                    {getStatusDisplay(connected, error, errorCode)}
                    {isCompatible &&
                  <Badge variant="default" size="sm">
                        {provider.apiType === "responses" ?
                    "Responses" :
                    "Chat"}
                      </Badge>
                  }
                    {isAnthropicCompatible &&
                  <Badge variant="default" size="sm">
                        Messages
                      </Badge>
                  }
                    {errorTime &&
                  <span className="text-dd-muted">{errorTime}</span>
                  }
                  </>
                }
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.total > 0 &&
            <div
              className="opacity-100"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();

              }}>

                <Toggle
                size="sm"
                checked={!allDisabled}
                disabled={saving}
                onChange={() => onToggle(allDisabled)}
                aria-label={allDisabled ? `Enable ${provider.name}` : `Disable ${provider.name}`}
                title={allDisabled ? "Enable provider" : "Disable provider"} />

              </div>
            }
          </div>
        </div>
      </Card>
    </Link>);

}

ApiKeyProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes['shape']({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string
  }).isRequired,
  stats: PropTypes['shape']({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string
  }).isRequired,
  authType: PropTypes.string,
  saving: PropTypes.bool,
  onToggle: PropTypes.func
};
