import { reactive } from "vue";

export type ConfirmationTone = "default" | "danger";
export type ConfirmationAction = "confirm" | "cancel" | "discard";

export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  discardLabel?: string;
  tone?: ConfirmationTone;
}

export const confirmationState = reactive({
  isOpen: false,
  title: "",
  message: "",
  confirmLabel: "确认",
  cancelLabel: "取消",
  discardLabel: "",
  tone: "default" as ConfirmationTone
});

let resolveConfirmation: ((action: ConfirmationAction) => void) | undefined;

export function requestConfirmation(options: ConfirmationOptions): Promise<boolean> {
  return requestConfirmationAction(options).then((action) => action === "confirm");
}

export function requestConfirmationAction(options: ConfirmationOptions): Promise<ConfirmationAction> {
  settleConfirmation("cancel");
  confirmationState.title = options.title;
  confirmationState.message = options.message;
  confirmationState.confirmLabel = options.confirmLabel ?? "确认";
  confirmationState.cancelLabel = options.cancelLabel ?? "取消";
  confirmationState.discardLabel = options.discardLabel ?? "";
  confirmationState.tone = options.tone ?? "default";
  confirmationState.isOpen = true;
  return new Promise<ConfirmationAction>((resolve) => {
    resolveConfirmation = resolve;
  });
}

export function settleConfirmation(action: ConfirmationAction | boolean): void {
  const resolve = resolveConfirmation;
  resolveConfirmation = undefined;
  confirmationState.isOpen = false;
  if (resolve !== undefined) resolve(typeof action === "boolean" ? (action ? "confirm" : "cancel") : action);
}
