import Link from "next/link";
import {
  Building2,
  ExternalLink,
  MoreHorizontal,
  Landmark,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getSuppliers, getPendingSuppliers, type SuppliersListResponse } from "@/lib/data/suppliers";
import { SupplierSearch } from "./SupplierSearch";
import { SupplierTabs } from "./SupplierTabs";
import { SupplierPagination } from "./SupplierPagination";
import { SupplierDirectoryFilters } from "./SupplierDirectoryFilters";
import { SupplierMatchingTab } from "./SupplierMatchingTab";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  console.time("SuppliersPage.execution");
  const sParams = await searchParams;
  const activeTab = (sParams.tab as string) || "directory";
  const statusFilter = (sParams.status as string) || "all";
  const page = parseInt((sParams.page as string) || "1", 10);
  const searchFilter = (sParams.search as string) || "";
  const limit = 20;
  const offset = (page - 1) * limit;

  // Fetch data based on active tab
  let suppliersData: SuppliersListResponse;
  let pendingSuppliers: any[] = [];

  if (activeTab === "matching") {
    console.time("SuppliersPage.getMatchingData");
    const [summaryData, pendingData] = await Promise.all([
      getSuppliers({
        limit: 1,
        search: searchFilter,
      }),
      getPendingSuppliers({
        limit: 100,
        search: searchFilter,
      }),
    ]);
    suppliersData = summaryData;
    pendingSuppliers = pendingData;
    console.timeEnd("SuppliersPage.getMatchingData");
  } else {
    console.time("SuppliersPage.getSuppliersData");
    suppliersData = await getSuppliers({
      limit,
      offset,
      status: activeTab === "matched" ? "matched" : statusFilter,
      search: searchFilter,
    });
    console.timeEnd("SuppliersPage.getSuppliersData");
  }

  const summaryData = suppliersData;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const totalPages = Math.ceil(
    (activeTab === "matched"
      ? summaryData.matchedCount
      : summaryData.totalCount) / limit
  );

  const result = (
    <div className="container mx-auto py-8 space-y-8">
      {/* ... existing JSX ... */}
    </div>
  );

  console.timeEnd("SuppliersPage.execution");
  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage and view suppliers discovered in the spending data.
          </p>
        </div>
        <SupplierSearch />
      </div>

      <SupplierTabs
        totalCount={summaryData.totalCount}
        matchedCount={summaryData.matchedCount}
        pendingCount={summaryData.pendingCount}
      />

      {activeTab === "directory" ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle>Supplier Directory</CardTitle>
              <CardDescription>
                All suppliers found in the spending datasets, ranked by total
                spend.
              </CardDescription>
            </div>
            <SupplierDirectoryFilters
              statusFilter={statusFilter}
              hasPendingSuppliers={suppliersData.suppliers.some(
                (s: any) => s.matchStatus === "pending"
              )}
              pendingSupplierIds={suppliersData.suppliers
                .filter((s: any) => s.matchStatus === "pending")
                .map((s: any) => s.id)}
            />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Companies House</TableHead>
                  <TableHead className="text-right">Total Spend</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliersData.suppliers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      No suppliers found.
                    </TableCell>
                  </TableRow>
                ) : (
                  suppliersData.suppliers.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/suppliers/${s.id}`}
                          className="hover:underline text-primary"
                        >
                          {s.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            s.matchStatus === "matched"
                              ? "default"
                              : s.matchStatus === "pending"
                              ? "secondary"
                              : "outline"
                          }
                          className="capitalize"
                        >
                          {s.matchStatus.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {s.entityName ? (
                          <Link
                            href={`/entities/${s.entityId}`}
                            className="flex flex-col hover:underline text-left group"
                          >
                            <span className="text-sm truncate max-w-[200px] group-hover:text-primary">
                              {s.entityName}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {s.entityType === "company" && s.companyNumber
                                ? `#${s.companyNumber}`
                                : s.entityType?.replace("_", " ")}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-sm italic">
                            Not linked
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(s.totalSpend || 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.transactionCount || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            asChild
                          >
                            <Link href={`/suppliers/${s.id}`}>
                              <ExternalLink className="size-4" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <SupplierPagination page={page} totalPages={totalPages} />
          </CardContent>
        </Card>
      ) : activeTab === "matched" ? (
        <Card>
          <CardHeader>
            <CardTitle>Matched Suppliers</CardTitle>
            <CardDescription>
              All suppliers that have been successfully linked to a legal
              entity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier Name</TableHead>
                  <TableHead>Companies House Entity</TableHead>
                  <TableHead className="text-right">Total Spend</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliersData.suppliers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No matched suppliers found.
                    </TableCell>
                  </TableRow>
                ) : (
                  suppliersData.suppliers.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/suppliers/${s.id}`}
                          className="hover:underline text-primary"
                        >
                          {s.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/entities/${s.entityId}`}
                          className="flex flex-col hover:underline text-left group"
                        >
                          <span className="text-sm truncate max-w-[250px] group-hover:text-primary">
                            {s.entityName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {s.companyNumber
                              ? `#${s.companyNumber}`
                              : "No company number"}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(s.totalSpend || 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.transactionCount || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          asChild
                        >
                          <Link href={`/suppliers/${s.id}`}>
                            <ExternalLink className="size-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <SupplierPagination page={page} totalPages={totalPages} />
          </CardContent>
        </Card>
      ) : (
        <SupplierMatchingTab
          initialSuppliers={pendingSuppliers}
          pendingCount={summaryData.pendingCount}
        />
      )}
    </div>
  );
}
