export function NumberGrid({ children, className = '' }) {
  const classes = ['list-number-grid', className].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}
