// localStorage can throw in Owlbear's cross-origin iframe (Safari "Block all
// cookies", some Firefox privacy modes). Everything here is a per-browser
// convenience, so a failure just means "not remembered".

export const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeLocal = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; still works for this session.
  }
};
