// Cross-platform Alert (2026-09-02, website triage item 1).
//
// react-native-web's Alert is a SILENT NO-OP: every confirmation dialog and
// the Sleeper-connect prompt simply did nothing in a browser, and
// Alert.prompt is iOS-only so Android was broken too. This shim keeps the
// exact RN Alert.alert / Alert.prompt call signatures so call sites only
// change their import.
//
//   web    → window.alert / window.confirm / window.prompt
//   iOS    → native Alert (unchanged behavior)
//   Android→ native Alert for .alert; a JS modal host for .prompt
//            (register <CrossPromptHost/> once in the root layout)
import { Alert as RNAlert, Platform } from 'react-native';

type Btn = { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: (v?: string) => void };

// ── prompt modal bridge (Android; also any platform with a host mounted) ──
type PromptRequest = { title: string; message?: string; onSubmit: (v: string) => void; onCancel: () => void };
let promptHost: ((req: PromptRequest) => void) | null = null;
export function registerPromptHost(fn: ((req: PromptRequest) => void) | null) { promptHost = fn; }

function webAlert(title: string, message?: string, buttons?: Btn[]) {
  const text = [title, message].filter(Boolean).join('\n\n');
  const actionable = (buttons ?? []).filter(b => b.onPress);
  const cancel = (buttons ?? []).find(b => b.style === 'cancel');
  const primary = (buttons ?? []).find(b => b.style !== 'cancel' && b.onPress) ?? actionable[0];
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    primary?.onPress?.();
    return;
  }
  if (window.confirm(text)) primary?.onPress?.();
  else cancel?.onPress?.();
}

export const Alert = {
  alert(title: string, message?: string, buttons?: Btn[], options?: { cancelable?: boolean }): void {
    if (Platform.OS === 'web') return webAlert(title, message, buttons);
    RNAlert.alert(title, message, buttons as any, options as any);
  },

  prompt(
    title: string,
    message?: string,
    callbackOrButtons?: ((v: string) => void) | Btn[],
    _type?: string,
    defaultValue?: string,
  ): void {
    const submit = (v: string) => {
      if (typeof callbackOrButtons === 'function') return callbackOrButtons(v);
      const ok = (callbackOrButtons ?? []).find(b => b.style !== 'cancel');
      ok?.onPress?.(v);
    };
    const cancel = () => {
      if (Array.isArray(callbackOrButtons)) {
        (callbackOrButtons ?? []).find(b => b.style === 'cancel')?.onPress?.();
      }
    };
    if (Platform.OS === 'web') {
      const v = window.prompt([title, message].filter(Boolean).join('\n\n'), defaultValue ?? '');
      if (v === null) cancel(); else submit(v);
      return;
    }
    if (Platform.OS === 'ios') {
      RNAlert.prompt(title, message, callbackOrButtons as any, _type as any, defaultValue);
      return;
    }
    // Android: RNAlert.prompt does not exist. Use the mounted modal host.
    if (promptHost) promptHost({ title, message, onSubmit: submit, onCancel: cancel });
    else RNAlert.alert(title, 'Text input is not available here yet.');
  },
};
