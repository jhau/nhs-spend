import Link from "next/link";
import {
  Building2,
  ExternalLink,
  Search,
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
import { getEntities } from "@/lib/data/entities";
import { EntitySearch } from "./EntitySearch";
import { EntityPagination } from "./EntityPagination";
import { EntityStats } from "./EntityStats";
import { cn } from "@/lib/utils";

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sParams = await searchParams;
  const typeFilter = (sParams.type as string) || "all";
  const page = parseInt((sParams.page as string) || "1", 10);
  const searchFilter = (sParams.search as string) || "";
  const limit = 20;
  const offset = (page - 1) * limit;

  const entitiesData = await getEntities({
    limit,
    offset,
    type: typeFilter,
    search: searchFilter,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const totalPages = Math.ceil(entitiesData.totalCount / limit);

  const getEntityTypeColor = (type: string) => {
    if (type === "company") return "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200";
    if (type.startsWith("nhs_")) return "bg-cyan-100 text-cyan-800 border-cyan-200 hover:bg-cyan-200";
    if (type === "council") return "bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200";
    if (type === "government_department") return "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200";
    return "bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200";
  };

  const getEntityTypeLabel = (type: string) => {
    if (type === "government_department") return "Government";
    return type.replace("_", " ");
  };

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Entities</h1>
          <p className="text-muted-foreground">
            Browse and search legal entities linked to spending data.
          </p>
        </div>
        <EntitySearch />
      </div>

      <EntityStats counts={entitiesData.countsByType} />

      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
          <div className="space-y-1">
            <CardTitle>Entity Directory</CardTitle>
            <CardDescription>
              Legal entities from Companies House, NHS ODS, and other registries.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity Name</TableHead>
                <TableHead className="text-right">Linked Suppliers</TableHead>
                <TableHead className="text-right">Linked Buyers</TableHead>
                <TableHead className="text-right">Total Spend</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entitiesData.entities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    No entities found.
                  </TableCell>
                </TableRow>
              ) : (
                entitiesData.entities.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <Link
                          href={`/entities/${e.id}`}
                          className="hover:underline text-primary"
                          title={`Registry ID: ${e.registryId}`}
                        >
                          {e.name}
                        </Link>
                        <div>
                          <Badge 
                            variant="outline" 
                            className={cn("capitalize text-[10px] px-1.5 py-0 h-4 font-medium border", getEntityTypeColor(e.entityType))}
                          >
                            {getEntityTypeLabel(e.entityType)}
                          </Badge>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {e.supplierCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.buyerCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(e.totalSpend)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {e.locality && <span>{e.locality}</span>}
                        {e.locality && e.postalCode && <span>, </span>}
                        {e.postalCode && (
                          <span className="text-muted-foreground">
                            {e.postalCode}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        asChild
                      >
                        <Link href={`/entities/${e.id}`}>
                          <ExternalLink className="size-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <EntityPagination page={page} totalPages={totalPages} />
        </CardContent>
      </Card>
    </div>
  );
}

