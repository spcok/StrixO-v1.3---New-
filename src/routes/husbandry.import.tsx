import React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { DailyRecordImporter } from '../components/husbandry/DailyRecordImporter';

export const Route = createFileRoute('/husbandry/import')({
  component: HusbandryImportRoute,
});

function HusbandryImportRoute() {
  return (
    <div className="p-2 md:p-6 animate-in fade-in duration-300">
      <DailyRecordImporter />
    </div>
  );
}

export default HusbandryImportRoute;