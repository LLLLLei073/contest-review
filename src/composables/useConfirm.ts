import { ref } from 'vue';

// 原生 confirm() 在 Electron/Windows 上会触发输入失效 bug（electron#31917），
// 全站改用应用内异步确认框；状态放模块级，ConfirmDialog 单点渲染。
const open = ref(false);
const message = ref('');
let resolver: ((ok: boolean) => void) | null = null;

export function useConfirm() {
  function confirmDialog(text: string): Promise<boolean> {
    message.value = text;
    open.value = true;
    return new Promise((resolve) => {
      resolver = resolve;
    });
  }
  function settleConfirm(ok: boolean) {
    open.value = false;
    resolver?.(ok);
    resolver = null;
  }
  return { open, message, confirmDialog, settleConfirm };
}
