"use client";

/**
 * <button> wrapper over the shared button vocabulary in lib/buttonStyles.
 *
 *   <Button variant="danger" confirm="Delete this?" onClick={...}>Delete</Button>
 *
 * For anything that isn't a <button> -- next/link <Link>, <a> -- import
 * buttonClass from lib/buttonStyles directly and pass it as className. Server
 * components must use that path too; see the note in that file.
 *
 * `confirm` is the reason this is a component and not only a class helper:
 * destructive actions are supposed to ask first, and bundling the dialog with
 * the red styling means that pairing can't drift apart one button at a time.
 * It's optional rather than type-required on `danger` because several handlers
 * build their dialog text from state mid-flow and confirm internally; forcing
 * those inside-out would be churn for its own sake.
 */

import { ButtonHTMLAttributes, ReactNode } from "react";
import { buttonClass, ButtonSize, ButtonVariant } from "../lib/buttonStyles";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  /**
   * Ask before running onClick. A function is evaluated at click time, so the
   * text can describe the state as it is at that moment; returning false skips
   * the dialog (for "this particular case isn't destructive after all").
   */
  confirm?: string | (() => string | false);
};

export default function Button({ variant, size, className, confirm, onClick, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={buttonClass({ variant, size, className })}
      onClick={(e) => {
        if (confirm) {
          const message = typeof confirm === "function" ? confirm() : confirm;
          if (message !== false && !window.confirm(message)) return;
        }
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
