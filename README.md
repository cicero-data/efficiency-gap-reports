# efficiency-gap-reports

Calculate and display partisan bias in a delegation's districts with efficiency gap scores.

Swap-out and configure election results and district boundaries then automatically generate a series of infographics for each delegation in the election.


## Install

Requires [Node.js](https://nodejs.org/).

Install dependencies with:

`npm install`


## Setup Election

Edit `config.yml` to point to your election data.


## Generate Reports

`npm run reports`

Images for each delegation will be written to the `figures` directory.
