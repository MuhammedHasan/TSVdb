#!/bin/bash 

tumor_type={{tumor_type}}

#mongoimport --drop --db sv --collection tx_pattern           --file tx_pattern.json
mongoimport --db sv --collection gene_expression_$tumor_type        --file ./json/gene_expression_$tumor_type.json        --drop
mongoimport --db sv --collection transcripts_expression_$tumor_type --file ./json/transcripts_expression_$tumor_type.json --drop
mongoimport --db sv --collection clinical_$tumor_type               --file ./json/clinical_$tumor_type.json               --drop
mongoimport --db sv --collection exon_count_$tumor_type             --file ./json/exon_count_$tumor_type.json             --drop
mongoimport --db sv --collection juc_count_$tumor_type              --file ./json/juc_count_$tumor_type.json              --drop
