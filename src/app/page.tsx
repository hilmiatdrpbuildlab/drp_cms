import { redirect } from "next/navigation";

// Only one module so far. The project planner will get its own entry here later.
export default function Home() {
  redirect("/blog");
}
