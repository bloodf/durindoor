import Modal from "./Modal";

/**
 * Right-edge native-dialog sheet.
 *
 * Mirrors Modal dismissal, focus, nesting, and scroll-lock semantics while
 * preserving Drawer `width`, `title`, `footer`, and children APIs.
 */
export default function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 420,
  footer,
  children,
  className,
  closeOnOverlay,
  closeOnEscape,
  pending,
  initialFocus,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={footer}
      className={className}
      closeOnOverlay={closeOnOverlay}
      closeOnEscape={closeOnEscape}
      pending={pending}
      initialFocus={initialFocus}
      layout="drawer"
      width={width}
    >
      {children}
    </Modal>
  );
}
