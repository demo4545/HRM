import { redirect } from "next/navigation";

/** Legacy Access Control route — unified under Employee → System Specifications. */
export default function SystemSpecsAdminRedirectPage() {
  redirect("/employee/system-specs");
}
