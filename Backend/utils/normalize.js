exports.normalizeArrayObjects = (arr, keyName = "name") => {
  if (!Array.isArray(arr)) return [];
  return arr.filter(Boolean).map(v =>
    typeof v === "string" ? { [keyName]: v } : v
  );
};
