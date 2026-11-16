/** Props that give an element a tooltip from the app's tooltip layer, with an optional shortcut. */
export const tip = (text: string, shortcut?: string) => ({ 'data-tip': text, 'data-shortcut': shortcut })
