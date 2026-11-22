/**
 * Diálogo de confirmação (o `AlertDialog` do Base UI): modal, com foco preso e Esc para fechar, sem
 * fechar no clique fora. Serve a uma decisão que não se desfaz, como apagar.
 */
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { cn } from "~/lib/utils";

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTitle = AlertDialogPrimitive.Title;
const AlertDialogDescription = AlertDialogPrimitive.Description;
const AlertDialogClose = AlertDialogPrimitive.Close;

function AlertDialogContent({ className, children, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-[140] bg-black/32 [-webkit-app-region:no-drag]" />
      <AlertDialogPrimitive.Viewport className="fixed inset-0 z-[141] flex items-center justify-center p-4">
        <AlertDialogPrimitive.Popup
          // O arrasto da janela do Electron ignora o z-index; sem isto, a barra de título engole os cliques.
          className={cn(
            "flex max-h-full w-[min(32rem,100%)] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-popover p-5 text-body text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none [-webkit-app-region:no-drag] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]",
            className,
          )}
          {...props}
        >
          {children}
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Viewport>
    </AlertDialogPrimitive.Portal>
  );
}

export { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogClose };
