/**
 * Script to compare Axe accessibility results across different sites and viewports
 * 
 * This script:
 * 1. Reads the result.json file containing Axe results
 * 2. Processes results for each site and viewport combination
 * 3. Compares sites by passes and violations for each viewport
 * 4. Outputs a sorted comparison showing how each site performs relative to the best
 */

// Define the interfaces for Axe results
interface EnvironmentData {
  // Axe environment data properties would go here
  // We don't need the specifics for our comparison
}

interface RunOptions {
  // Axe run options properties would go here
  // We don't need the specifics for our comparison
}

interface Result {
  // Individual result properties 
  // We don't need these details for our comparison
}

interface AxeResults extends EnvironmentData {
  toolOptions: RunOptions;
  passes: Result[];
  violations: Result[];
  incomplete: Result[];
  inapplicable: Result[];
}

type ResultsRecord = Record<string, AxeResults>;

// Interface for our viewport result data
interface ViewportResult {
  site: string;
  viewport: string;
  passes: number;
  violations: number;
  passDifference: number; // How many fewer passes than the best in this viewport
  violationDifference: number; // How many more violations than the best in this viewport
}

/**
 * Main function to process the results
 * @param resultsData The parsed result.json data
 */
function compareAxeResults(resultsData: ResultsRecord): void {
  // Extract all results into a more processable format
  const allResults: ViewportResult[] = [];
  const viewports = new Set<string>();
  
  for (const key in resultsData) {
    // Parse the key format "viewportNAME url"
    const parts = key.split(' ');
    const viewport = parts[0];
    const site = parts.slice(1).join(' ');
    
    viewports.add(viewport);
    
    // Get the result data
    const result = resultsData[key];
    
    allResults.push({
      site,
      viewport,
      passes: result.passes.length,
      violations: result.violations.length,
      passDifference: 0, // Will calculate later
      violationDifference: 0 // Will calculate later
    });
  }
  
  // Group by viewport and find best scores for each
  const viewportGroups = Array.from(viewports).map(viewport => {
    const viewportResults = allResults.filter(r => r.viewport === viewport);
    
    // Sort by violations ascending
    viewportResults.sort((a, b) => a.violations - b.violations);
    
    // Find best values for this viewport
    const bestPasses = viewportResults.length > 0 ? viewportResults[0].passes : 0;
    const bestViolations = Math.min(...viewportResults.map(r => r.violations));
    
    // Calculate differences
    viewportResults.forEach(result => {
      result.passDifference = bestPasses - result.passes;
      result.violationDifference = result.violations - bestViolations;
    });
    
    return {
      viewport,
      results: viewportResults
    };
  });
  
  // Sort viewports for consistent output
  viewportGroups.sort((a, b) => a.viewport.localeCompare(b.viewport));
  
  // Output formatted results for each viewport
  viewportGroups.forEach(group => {
    console.log(`\n=== Viewport: ${group.viewport} (Sorted by Violations) ===\n`);
    
    // Define column widths
    const siteWidth = 30;
    const passesWidth = 6;
    const violationsWidth = 10;
    const passDiffWidth = 17;
    const violDiffWidth = 21;
    
    // Create header row with matching column widths
    const headerRow = 
      `| ${'Site'.padEnd(siteWidth)} | ` +
      `${'Passes'.padStart(passesWidth)} | ` +
      `${'Violations'.padStart(violationsWidth)} | ` +
      `${'Passes Difference'.padStart(passDiffWidth)} | ` +
      `${'Violations Difference'.padStart(violDiffWidth)} |`;
    
    // Create separator matching the header length
    const separatorRow = '|' + '-'.repeat(headerRow.length - 2) + '|';
    
    console.log(headerRow);
    console.log(separatorRow);
    
    group.results.forEach(result => {
      const passDiffText = result.passDifference > 0 ? `-${result.passDifference}` : '0';
      const violationDiffText = result.violationDifference > 0 ? `+${result.violationDifference}` : '0';
      
      console.log(
        `| ${result.site.padEnd(siteWidth).substring(0, siteWidth)} | ` +
        `${String(result.passes).padStart(passesWidth)} | ` +
        `${String(result.violations).padStart(violationsWidth)} | ` +
        `${passDiffText.padStart(passDiffWidth)} | ` +
        `${violationDiffText.padStart(violDiffWidth)} |`
      );
    });
  });
  
  console.log('\n* "Passes Difference" shows how many fewer passes a site has compared to the best site in that viewport.');
  console.log('* "Violations Difference" shows how many more violations a site has compared to the site with the fewest violations in that viewport.');
}

// Load and process the results
import * as fs from 'fs';

try {
  // Read the JSON file
  const resultsJson = fs.readFileSync('result.json', 'utf8');
  const resultsData: ResultsRecord = JSON.parse(resultsJson);
  
  // Process the results
  compareAxeResults(resultsData);
} catch (error) {
  console.error('Error processing results:', error);
}