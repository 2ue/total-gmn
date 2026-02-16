const ENV_KEY = "PROFIT_INCLUDE_CLOSED_DIRECTION_IN_PROFIT";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return defaultValue;
}

export function shouldIncludeClosedDirectionInProfit(
  value: string | undefined = process.env[ENV_KEY]
): boolean {
  return parseBooleanEnv(value, true);
}

export function getClosedProfitModeEnvKey(): string {
  return ENV_KEY;
}
