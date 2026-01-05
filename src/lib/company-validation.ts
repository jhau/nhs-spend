// Patterns that indicate non-company entries (Individuals, generic terms, placeholders)
const NON_COMPANY_PATTERNS = [
  // Individual names/titles - only if not followed by company suffixes
  /^(DR|MR|MRS|MS|MISS|PROF|REV)\s+/i,
  /^(DOCTOR|MISTER|PROFESSOR)\s+/i,

  // Generic payment terms / Administrative entries
  /^SALARY$/i,
  /^SALARIES$/i,
  /^REFUND$/i,
  /^REFUNDS$/i,
  /^PETTY CASH$/i,
  /^CASH$/i,
  /^SUNDRY$/i,
  /^MISC(ELLANEOUS)?$/i,
  /^VARIOUS$/i,
  /^TRANSFER$/i,
  /^PAYMENT$/i,
  /^PAYROLL$/i,

  // Redacted or placeholder terms
  /^REDACTED$/i,
  /^CONFIDENTIAL$/i,
  /^WITHHELD$/i,
  /^N\/A$/i,
  /^NOT APPLICABLE$/i,
  /^UNKNOWN$/i,
  /^TBC$/i,
  /^TBA$/i,
];

const COMPANY_SUFFIX_PATTERN = /\b(LTD|LIMITED|PLC|LLP|INC|CORP|CORPORATION)\b/i;

/**
 * Checks if a name is likely NOT a company, council, or government department.
 * Returns the reason if it should be skipped, or null if it's a valid candidate for matching.
 */
export function isLikelyNotACompany(name: string): { reason: string } | null {
  const trimmed = name.trim();

  // 1. Purely numeric strings
  if (/^\d+$/.test(trimmed)) {
    return { reason: "purely numeric" };
  }

  // 2. Very short names
  if (trimmed.length < 2) {
    return { reason: "too short" };
  }

  // 3. Known non-company patterns
  for (const pattern of NON_COMPANY_PATTERNS) {
    if (pattern.test(trimmed)) {
      // Special case: if it starts with a title but ends with a company suffix, it's likely a company
      if (/^(DR|MR|MRS|MS|MISS|PROF|REV|DOCTOR|MISTER|PROFESSOR)\s+/i.test(trimmed) && COMPANY_SUFFIX_PATTERN.test(trimmed)) {
        continue;
      }
      return { reason: "matches non-company pattern (individual or generic term)" };
    }
  }

  // 4. Random ID check
  if (!trimmed.includes(" ")) {
    const digitCount = (trimmed.match(/\d/g) || []).length;
    if (trimmed.length > 6 && digitCount / trimmed.length > 0.6) {
      return { reason: "likely a random ID or reference number (high digit density)" };
    }
    
    const vowelCount = (trimmed.match(/[aeiou]/gi) || []).length;
    if (trimmed.length > 8 && vowelCount === 0 && /[a-z]/i.test(trimmed)) {
      return { reason: "likely a random ID (no vowels)" };
    }
  }

  return null;
}
