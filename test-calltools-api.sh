#!/bin/bash

# CallTools API Endpoint Tester
# Replace YOUR_API_KEY with your actual API key

API_KEY="YOUR_API_KEY_HERE"

echo "Testing CallTools API endpoints..."
echo "=================================="
echo ""

# Test different possible endpoints
endpoints=(
  "https://app.calltools.com/api"
  "https://api.calltools.com"
  "https://www.calltools.com/api"
  "https://calltools.com/api"
  "https://app.calltools.com/api/v1"
  "https://api.calltools.com/v1"
  "https://api.calltools.com/v2"
)

for endpoint in "${endpoints[@]}"
do
  echo "Testing: $endpoint"
  response=$(curl -s -w "\n%{http_code}" -H "Authorization: Token $API_KEY" "$endpoint/contacts" 2>&1 | tail -1)
  
  if [ "$response" = "200" ] || [ "$response" = "401" ] || [ "$response" = "403" ]; then
    echo "✅ FOUND! This endpoint responds: $endpoint"
    echo "   HTTP Status: $response"
    echo ""
  else
    echo "❌ Not working (Status: $response)"
    echo ""
  fi
done

echo "=================================="
echo "Look for the ✅ FOUND! endpoint above"