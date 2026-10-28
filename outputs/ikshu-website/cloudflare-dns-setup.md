# Connect ikshuintelligence.com

The website is live at https://ikshuintelligence.com. The original hosting URL remains https://ikshu-intelligence.rushikesh-ikshu.chatgpt.site.

Custom domain status: active. SSL status: active. DNS connection completed and verified on 11 October 2026.

The following records are saved in **Cloudflare → ikshuintelligence.com → DNS → Records**:

| Type | Name | Content | Proxy status |
| --- | --- | --- | --- |
| A | @ | 162.159.143.30 | DNS only |
| A | @ | 172.66.3.26 | DNS only |
| TXT | _openai-site-verification | openai-site-verification=0FzX6Z0-TV8sY8DNpqfjOxjWVefI6zHQ9MoRB4VjVNI | Not applicable |
| TXT | _cf-custom-hostname | 92aa41e9-576b-4bd1-a6e7-294a4f6741b2 | Not applicable |

All four records use automatic TTL. The previous apex A record (76.76.21.21) was replaced. The three Zoho MX records and Zoho verification TXT record were preserved. The existing www CNAME remains cname.vercel-dns.com and does not route to this new website. The previous settings are saved in dns-before-connection.md.

Verified: public DNS resolves both supplied A addresses, domain and SSL statuses are active, and the company-domain homepage, login, demo and privacy pages return HTTP 200 over verified HTTPS. Anonymous workspace requests return 401; the portal redirects to hosted sign-in, whose callback uses ikshuintelligence.com. A real signed-in production account session has not been tested in this task.

Cloudflare reference: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/apex-proxying/setup/

The mill login uses hosted ChatGPT sign-in. Each account has its own database workspace. The demonstration uses illustrative data. Satellite observations are entered/imported; no automatic satellite connector or quality prediction service is active in this version.

