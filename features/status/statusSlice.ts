import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

export type SavingStatus = 'idle' | 'saving' | 'saved';
export type NotificationType = 'success' | 'error' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description?: string;
}

export interface StatusState {
  saving: SavingStatus;
  notifications: Notification[];
}

const initialState: StatusState = {
  saving: 'idle',
  notifications: [],
};

const statusSlice = createSlice({
  name: 'status',
  initialState,
  reducers: {
    setSavingStatus(state, action: PayloadAction<SavingStatus>) {
      state.saving = action.payload;
    },
    addNotification(state, action: PayloadAction<Omit<Notification, 'id'> & { id?: string }>) {
      const id = action.payload.id || uuidv4();
      state.notifications.push({ ...action.payload, id });
    },
    removeNotification(state, action: PayloadAction<string>) {
      state.notifications = state.notifications.filter((n) => n.id !== action.payload);
    },
  },
});

export const statusActions = statusSlice.actions;
export default statusSlice.reducer;
