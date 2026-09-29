export type SortOrder = "asc" | "desc";

export type Column<T> = {
  key: keyof T | string;
  header: React.ReactNode;
  className?: string;
  sortable?: boolean;
  sticky?: "left" | "right";
  render?: (row: T) => React.ReactNode;
};
