import { getPastEmployees } from '../actions';
import PastEmployeesClient from './PastEmployeesClient';
export const revalidate = 60;
export default async function PastEmployeesPage() {
  const employees = await getPastEmployees();
  return <PastEmployeesClient employees={employees} />;
}
