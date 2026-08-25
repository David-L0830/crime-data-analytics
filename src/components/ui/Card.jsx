// Generic card container — matches the original `.card` styling used everywhere
// (dashboard tiles, table wrappers, filter panels).
export default function Card({
  title,
  actions,
  className = '',
  children,
  bodyClassName = '',
}) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          {title && <h3>{title}</h3>}
          {actions}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
