export const params: { current: Record<string, string> } = { current: {} };
export const setParams = (p: Record<string, string>) => {
  params.current = p;
};
