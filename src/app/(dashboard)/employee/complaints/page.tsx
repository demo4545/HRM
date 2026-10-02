"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";

const rows = [
  { id: "1", subject: "Cafeteria hygiene", raised: "Neha", state: "Open" },
  { id: "2", subject: "IT asset delay", raised: "Rahul", state: "Resolved" },
];

export default function ComplaintsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Complaint Registration"
        description="Track workplace issues with routing and SLAs. Super Admin and HR have elevated visibility."
      />
      <Card>
        <CardHeader>
          <CardTitle>New Complaint</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Subject</Label>
            <Input placeholder="Short title" />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select defaultValue="workplace">
              <option value="workplace">Workplace</option>
              <option value="it">IT</option>
              <option value="people">People & Culture</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Severity</Label>
            <Select defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Details</Label>
            <Textarea rows={4} />
          </div>
          <Button className="w-fit md:col-span-2">Submit</Button>
        </CardContent>
      </Card>
      <DataTable
        rows={rows}
        columns={[
          { key: "subject", header: "Subject" },
          { key: "raised", header: "Raised by" },
          {
            key: "state",
            header: "State",
            render: (r) => (
              <Badge variant={r.state === "Resolved" ? "success" : "warning"}>{r.state}</Badge>
            ),
          },
        ]}
      />
    </div>
  );
}
