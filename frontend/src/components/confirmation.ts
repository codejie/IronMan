import { reactive } from "vue";

export type ConfirmationTone = "default" | "danger";

export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmationTone;
}

export const confirmationState = reactive({
  isOpen: false,
  title: "",
  message: "",
  confirmLabel: "确认",
  cancelLabel: "取消",
  tone: "default" as ConfirmationTone
});

let resolveConfirmation: ((confirmed: boolean) => void) | undefined;

export function requestConfirmation(options: ConfirmationOptions): Promise<boolean> {
  settleConfirmation(false);
  confirmationState.title = options.title;
  confirmationState.message = options.message;
  confirmationState.confirmLabel = options.confirmLabel ?? "确认";
  confirmationState.cancelLabel = options.cancelLabel ?? "取消";
  confirmationState.tone = options.tone ?? "default";
  confirmationState.isOpen = true;
  return new Promise<boolean>((resolve) => {
    resolveConfirmation = resolve;
  });
}

export function settleConfirmation(confirmed: boolean): void {
  const resolve = resolveConfirmation;
  resolveConfirmation = undefined;
  confirmationState.isOpen = false;
  if (resolve !== undefined) resolve(confirmed);
}
