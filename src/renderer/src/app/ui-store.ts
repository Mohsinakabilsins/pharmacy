import { create } from 'zustand';

interface UiState {
  paletteOpen: boolean;
  passwordOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  openPassword: () => void;
  closePassword: () => void;
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  passwordOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  openPassword: () => set({ passwordOpen: true }),
  closePassword: () => set({ passwordOpen: false }),
}));
