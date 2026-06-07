"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerFieldProps {
  label: string;
  date: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  maxDate?: Date;
}

export function DatePickerField({ label, date, onSelect, maxDate }: DatePickerFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-[200px] justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, "yyyy-MM-dd") : "Select date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={onSelect}
            disabled={maxDate ? { after: maxDate } : undefined}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
