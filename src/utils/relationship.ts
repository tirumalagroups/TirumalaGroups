/**
 * Customer relationship (guardian) helpers.
 *
 * Saved in finance_customers.father_name / father_husband_name as "TYPE:NAME",
 * e.g. "S/O:SRINIVAS REDDY". Older records use "Father:NAME", "Husband:NAME",
 * "Wife:NAME" or just a plain name.
 */

export const RELATIONSHIP_OPTIONS: { value: string; label: string }[] = [
  { value: 'S/O', label: 'Son of (S/O)' },
  { value: 'D/O', label: 'Daughter of (D/O)' },
  { value: 'W/O', label: 'Wife of (W/O)' },
  { value: 'F/O', label: 'Father of (F/O)' },
];

const VALID_TYPES = new Set(RELATIONSHIP_OPTIONS.map(o => o.value));

/** Split the saved value into its type and name. Type is '' when there is none. */
export const parseRelationship = (raw: string | null | undefined): { type: string; name: string } => {
  const text = (raw || '').trim();
  if (!text) return { type: '', name: '' };
  const idx = text.indexOf(':');
  if (idx === -1) return { type: '', name: text };
  return { type: text.slice(0, idx).trim(), name: text.slice(idx + 1).trim() };
};

/**
 * The relationship choice to pre-select when editing a customer.
 * Old "Husband" means the customer is the wife of that person (W/O).
 * Old "Father" / "Wife" can't tell son vs daughter, so they return '' and the user picks again.
 */
export const relationshipTypeForEdit = (raw: string | null | undefined): string => {
  const { type } = parseRelationship(raw);
  const upper = type.toUpperCase();
  if (VALID_TYPES.has(upper)) return upper;
  if (upper === 'HUSBAND') return 'W/O';
  return '';
};

/** Short label shown before the name: "S/O", "W/O", ... ("FATHER" etc. for old records). */
export const relationshipLabel = (raw: string | null | undefined): string => {
  const { type } = parseRelationship(raw);
  const upper = type.toUpperCase();
  if (VALID_TYPES.has(upper)) return upper;
  if (upper === 'HUSBAND') return 'W/O';
  return upper;
};

/** Full guardian text for tables and prints, e.g. "S/O SRINIVAS REDDY" or "FATHER: RAMU". */
export const formatRelationship = (raw: string | null | undefined): string => {
  const { name } = parseRelationship(raw);
  if (!name) return '';
  const label = relationshipLabel(raw);
  if (!label) return name;
  return VALID_TYPES.has(label) ? `${label} ${name}` : `${label}: ${name}`;
};

/** Label + name pair used on customer / loan screens ("S/O" + "SRINIVAS REDDY"). */
export const getRelationshipDisplay = (raw: string | null | undefined): { label: string; name: string; type: string } => {
  const { type, name } = parseRelationship(raw);
  if (!type && !name) return { label: 'Father/Husband/Wife', name: 'N/A', type: '' };
  return { label: relationshipLabel(raw) || 'Father/Husband', name, type };
};
