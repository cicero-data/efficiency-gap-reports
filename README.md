# efficiency-gap-reports

Calculate and display partisan bias in a delegation's districts with efficiency gap scores.

Swap-out and configure election results and district boundaries then automatically generate a series of infographics for each delegation in the election.

## Learn More

![Azavea Data Analytics](https://www.azavea.com/wp-content/uploads/2016/06/azavea-logo-2x.png)

A project of [Azavea Data Analytics](https://www.azavea.com/services/data-analytics/).

Read more about the methods used in this project on the [Azavea Blog, "Leveraging Node.js, D3.js, and HTML Canvas for Scalable Infographics"](https://www.azavea.com/blog/2017/07/20/node-js-d3-canvas-scalable-graphics/).

For more information about Azavea's redistricting work, read ["The Evolution of Azavea’s Redistricting and Gerrymandering Work"](https://www.azavea.com/blog/2017/07/18/the-evolution-of-azaveas-redistricting-and-gerrymandering-work/).

## Data

By default, this project is setup to generate reports on the 2016 US Congressional election. The file [`results.csv`](https://github.com/cicero-data/efficiency-gap-reports/blob/master/results.csv) is the data used to generate reports.


## Install

Requires [Node.js](https://nodejs.org/).

Install dependencies with:

`npm install`


## Setup Election

Edit `config.yml` to point to your election data.


## Generate Reports

`npm run reports`

Images for each delegation will be written to the `figures` directory.
