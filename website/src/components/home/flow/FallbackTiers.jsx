"use client";
import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import { FALLBACK_TIERS } from "../content.js";
export default function FallbackTiers() {
  const { t } = useHomeLocale();
  return (
    <div className="combo-explanation">
      <div>
        <h3>{t("You choose the fallback order")}</h3>
        <p>
          {t(
            "A combo gives your client one model name. DurinDoor tries its configured members in order, retrying eligible accounts before moving to the next model.",
          )}
        </p>
      </div>
      <div className="combo-example">
        <p>{t("Example configuration")}</p>
        <div className="combo-name">
          <span>{t("Model")}</span>
          <code>coding-default</code>
        </div>
        <ol>
          {FALLBACK_TIERS.map((member, i) => (
            <li key={member.model}>
              <span className="combo-order">{i + 1}</span>
              <img
                src={member.logo}
                alt=""
                width="24"
                height="24"
                loading="lazy"
              />
              <code>{member.model}</code>
            </li>
          ))}
        </ol>
        <p className="combo-note">
          {t(
            "This order is an example, not a built-in subscription, API, or local-model priority.",
          )}
        </p>
      </div>
    </div>
  );
}
