const VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

export default function Button({
  children, variant = 'primary', size, icon, className = '', type = 'button', ...rest
}) {
  const cls = ['btn', VARIANT_CLASS[variant] || VARIANT_CLASS.primary, size === 'sm' ? 'btn-sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon && <span>{icon}</span>} {children}
    </button>
  );
}
