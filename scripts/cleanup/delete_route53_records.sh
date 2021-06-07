function delete_route53_record() {
    echo "About to delete record $1" > /dev/tty
    aws route53 change-resource-record-sets --hosted-zone-id $1 --change-batch `{"Comment":"DELETE a record ","Changes":[{"Action": "DELETE","ResourceRecordSet": {"Name": "$2","Type": "A","ResourceRecords": [{"Value": "$2"}]}}]}`
END
}

function delete_route53_records() { 
  while : ; do
    aws route53 list-resource-record-sets --hosted-zone-id $1 --query "ResourceRecordSets[?(ends_with(Name, 'qa.thinkr.dev.') && (Type =='A' || Type =='CNAME'))] | [*].[Name]" --output text $starting_token | while read -r line ; do
      delete_route53_record $1 $line
    done
    next_token=$(aws route53 list-resource-record-sets --hosted-zone-id $1 --query NextToken --output text | grep -v None)
    if [ -z "$next_token" ]; then
      starting_token=""
      break
    else
      starting_token="--starting-token $next_token"
    fi
  done
  echo "Done deleting Route53 record sets" > /dev/tty
}