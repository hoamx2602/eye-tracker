'use client';

import React from 'react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

type ModalProps = {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  /** Optional extra z-index if stacking with other overlays. */
  zIndexClassName?: string;
  /** Control max-width of the dialog. Defaults to `md` (max-w-lg). */
  size?: ModalSize;
  /** Additional classes for the outer dialog container (not the backdrop). */
  className?: string;
  /** If true, clicking backdrop does NOT close modal. */
  disableBackdropClose?: boolean;
  /** Optional role label / labelledBy can be handled by children; this keeps shell generic. */
};

const sizeToMaxWidth: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export default function Modal({
  open,
  onClose,
  children,
  zIndexClassName = 'z-[300]',
  size = 'md',
  className = '',
  disableBackdropClose = false,
}: ModalProps) {
  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disableBackdropClose) return;
    if (!onClose) return;
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center bg-black/70 backdrop-blur-sm p-4`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${sizeToMaxWidth[size]} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

