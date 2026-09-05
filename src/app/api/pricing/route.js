import { NextResponse } from "next/server";
import { getPricing, updatePricing, resetPricing, resetAllPricing } from "@/lib/localDb.js";
import { getDefaultPricing } from "open-sse/providers/pricing.js";

/**
 * GET /api/pricing
 * Get current pricing configuration (merged user + defaults)
 */
import { isNumber, isObject } from "../../../shared/utils/typeChecks.js";
const PRICING_FIELDS = new Set(["input", "output", "cached", "reasoning", "cache_creation"]);
const READ_ONLY_TIER_FIELDS = new Set([
  "longContextThreshold",
  "longContextInputMultiplier",
  "longContextOutputMultiplier",
]);

function isValidPrice(value) {
  return isNumber(value) && Number.isFinite(value) && value >= 0;
}

function readOnlyTierMetadata(provider, model) {
  const defaults = getDefaultPricing()[provider]?.[model] || {};
  return Object.fromEntries(
    [...READ_ONLY_TIER_FIELDS]
      .filter((key) => defaults[key] !== undefined)
      .map((key) => [key, defaults[key]])
  );
}

function isDefaultTierMetadata(provider, model, key, value) {
  const tier = readOnlyTierMetadata(provider, model);
  return Object.hasOwn(tier, key) && value === tier[key];
}

function validatedPricingUpdate(body) {
  const update = {};

  for (const [provider, models] of Object.entries(body)) {
    if (!isObject(models) || models === null || Array.isArray(models)) {
      return { error: `Invalid pricing for provider: ${provider}` };
    }

    update[provider] = {};
    for (const [model, pricing] of Object.entries(models)) {
      if (!isObject(pricing) || pricing === null || Array.isArray(pricing)) {
        return { error: `Invalid pricing for model: ${provider}/${model}` };
      }

      const priceUpdate = {};
      for (const [key, value] of Object.entries(pricing)) {
        if (PRICING_FIELDS.has(key)) {
          if (!isValidPrice(value)) {
            return { error: `Invalid pricing value for ${key} in ${provider}/${model}: must be finite non-negative number` };
          }
          priceUpdate[key] = value;
        } else if (!isDefaultTierMetadata(provider, model, key, value)) {
          return { error: `Invalid pricing field: ${key} for ${provider}/${model}` };
        }
      }
      update[provider][model] = priceUpdate;
    }
  }

  return { update };
}

export async function GET() {
  try {
    const pricing = await getPricing();
    return NextResponse.json(pricing);
  } catch (error) {
    console.error("Error fetching pricing:", error);
    return NextResponse.json(
      { error: "Failed to fetch pricing" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/pricing
 * Update pricing configuration
 * Body: { provider: { model: { input: number, output: number, cached: number, ... } } }
 */
export async function PATCH(request) {
  try {
    const body = await request.json();

    // Validate body structure
    if (!isObject(body) || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Invalid pricing data format" },
        { status: 400 }
      );
    }

    const validated = validatedPricingUpdate(body);
    if (validated.error) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const updatedPricing = await updatePricing(validated.update);
    return NextResponse.json(updatedPricing);

  } catch (error) {
    console.error("Error updating pricing:", error);
    return NextResponse.json(
      { error: "Failed to update pricing" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/pricing
 * Reset pricing to defaults
 * Query params: ?provider=xxx&model=yyy (optional)
 */
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");

    if (provider && model) {
      // Reset specific model
      await resetPricing(provider, model);
    } else if (provider) {
      // Reset entire provider
      await resetPricing(provider);
    } else {
      // Reset all pricing
      await resetAllPricing();
    }

    const pricing = await getPricing();
    return NextResponse.json(pricing);
  } catch (error) {
    console.error("Error resetting pricing:", error);
    return NextResponse.json(
      { error: "Failed to reset pricing" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/pricing/defaults
 * Get default pricing configuration
 */
export async function GET_DEFAULTS() {
  try {
    const defaultPricing = getDefaultPricing();
    return NextResponse.json(defaultPricing);
  } catch (error) {
    console.error("Error fetching default pricing:", error);
    return NextResponse.json(
      { error: "Failed to fetch default pricing" },
      { status: 500 }
    );
  }
}